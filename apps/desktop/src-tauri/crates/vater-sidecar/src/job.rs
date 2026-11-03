//! 사이드카를 셸 프로세스와 함께 끝나게 묶는다 (Windows 작업 개체).
//!
//! `Vater.exe`가 비정상 종료되거나 강제로 끝나도 `vater-core.exe`가 남지 않게 한다.
//! 남으면 다시 실행한 셸이 사이드카를 하나 더 띄워 한투 WebSocket 세션과 일정 작업이 겹친다.
//!
//! 셸은 프로세스마다 작업 개체 하나를 만들어 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`를 걸고,
//! 그 핸들을 끝까지 닫지 않는다. 셸이 어떻게 끝나든 운영체제가 핸들을 닫으면서
//! 작업 안의 프로세스(사이드카와 그 자식)를 모두 끝낸다. Windows가 아니면 아무것도 하지 않는다.

use std::io;

/// 자식 프로세스를 셸의 작업 개체에 넣는다.
pub(crate) fn bind_to_shell(child: &tokio::process::Child) -> io::Result<()> {
    imp::bind(child)
}

#[cfg(windows)]
mod imp {
    use std::io;
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    /// 셸이 끝날 때까지 닫지 않는 작업 개체 핸들.
    struct Job(HANDLE);

    // SAFETY: 작업 개체 핸들은 프로세스 전체의 커널 핸들이라 어느 스레드에서 써도 된다.
    // 닫지 않으므로(셸이 끝날 때 운영체제가 닫는다) 해제 경쟁도 없다.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    /// 만들지 못했으면 그때의 Windows 오류 코드.
    static JOB: OnceLock<Result<Job, i32>> = OnceLock::new();

    /// 작업 개체에 거는 제한: 핸들이 닫히면 안의 프로세스를 모두 끝낸다.
    pub(super) fn limits() -> JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        info
    }

    fn create() -> io::Result<Job> {
        // SAFETY: 기본 보안 설정과 이름 없는 작업 개체(두 인자 모두 null).
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let info = limits();
        // SAFETY: `info`는 이 호출 동안 살아 있고, 형식과 크기를 정확히 넘긴다.
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&raw const info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            // SAFETY: 방금 만든 핸들이고 다른 곳에 넘기지 않았다.
            unsafe { CloseHandle(handle) };
            return Err(error);
        }
        Ok(Job(handle))
    }

    /// 셸 프로세스의 작업 개체(처음 부를 때 만든다).
    pub(super) fn job_handle() -> io::Result<HANDLE> {
        match JOB.get_or_init(|| create().map_err(|e| e.raw_os_error().unwrap_or(-1))) {
            Ok(job) => Ok(job.0),
            Err(code) => Err(io::Error::from_raw_os_error(*code)),
        }
    }

    pub(super) fn bind(child: &tokio::process::Child) -> io::Result<()> {
        let process = child
            .raw_handle()
            .ok_or_else(|| io::Error::other("the child process has already been waited for"))?;
        let job = job_handle()?;
        // SAFETY: 작업 개체 핸들은 닫지 않고, 자식 핸들은 아직 기다리지 않아 살아 있다.
        if unsafe { AssignProcessToJobObject(job, process as HANDLE) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    pub(super) fn bind(_child: &tokio::process::Child) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    #[test]
    fn job_kills_its_processes_when_the_shell_goes_away() {
        assert_eq!(
            imp::limits().BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        );
    }

    #[tokio::test]
    async fn bound_child_is_in_the_shell_job() {
        // 30초쯤 살아 있는 아무 프로세스
        let mut child = tokio::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        bind_to_shell(&child).unwrap();

        let process = child.raw_handle().unwrap() as HANDLE;
        let job = imp::job_handle().expect("the shell job exists after binding");
        let mut in_job = 0;
        // SAFETY: 두 핸들 모두 살아 있고(자식은 아직 기다리지 않았다), 결과 포인터는 지역 변수다.
        let ok = unsafe { IsProcessInJob(process, job, &mut in_job) };
        assert_ne!(
            ok,
            0,
            "IsProcessInJob failed: {}",
            io::Error::last_os_error()
        );
        assert_ne!(in_job, 0, "child is not in the shell job");

        child.kill().await.unwrap();
    }
}
