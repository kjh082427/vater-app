import { useEffect, useState } from 'react';
import { useServices } from '../../api/services';
import { Button } from '../../design-system';
import type { UpdateInfo } from '../../platform';
import common from '../common/screen.module.css';
import styles from './settings.module.css';

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 설정 > 일반: [업데이트 확인]과 새 버전 설치(스펙 0장 성공 기준 5, 11장). */
export function UpdateRow() {
  const { platform } = useServices();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState<'check' | 'install' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 알림이나 배너로 들어왔을 때 [지금 설치]가 바로 보이게 조용히 확인한다. 새 버전일 때만 보이고 실패는 숨긴다.
  useEffect(() => {
    let alive = true;
    platform.checkUpdate().then(
      (found) => {
        if (alive && found.state === 'available') setInfo((prev) => prev ?? found);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [platform]);

  async function check() {
    setBusy('check');
    setError(null);
    setInfo(null);
    try {
      setInfo(await platform.checkUpdate());
    } catch (e) {
      setError(`업데이트를 확인하지 못했습니다: ${messageOf(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    setBusy('install');
    setError(null);
    try {
      await platform.installUpdate();
    } catch (e) {
      setError(`업데이트를 설치하지 못했습니다: ${messageOf(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.updateRow}>
      <Button size="sm" disabled={busy !== null} onClick={() => void check()}>
        업데이트 확인
      </Button>
      {info?.state === 'up_to_date' ? <span className={common.meta}>최신 버전입니다.</span> : null}
      {info?.state === 'disabled' ? (
        <span className={common.meta}>이 빌드에서는 업데이트를 쓸 수 없습니다.</span>
      ) : null}
      {info?.state === 'available' ? (
        <>
          <span>{`새 버전 ${info.version}이(가) 있습니다.`}</span>
          {info.notes ? <span className={common.meta}>{info.notes}</span> : null}
          <Button
            size="sm"
            variant="primary"
            disabled={busy !== null}
            onClick={() => void install()}
          >
            지금 설치
          </Button>
          <span className={common.meta}>설치하면 앱이 다시 시작됩니다.</span>
        </>
      ) : null}
      {error ? (
        <span role="alert" className={common.meta}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
