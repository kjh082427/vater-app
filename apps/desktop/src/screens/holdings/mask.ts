/**
 * 연결 목록에 보이는 구분 표시를 앱에서도 같게 만든다(사이드카 holdings/service.py와 같은 규칙).
 * 계좌번호가 있으면 `****끝4자리`, 없으면(키움·메리츠) 앱키 SHA-256 앞 4자리 `키 ab12`.
 * "해제한 같은 계좌에 이어 붙일까요?"를 묻는 데만 쓰고, 값은 어디에도 저장하거나 보내지 않는다.
 */
export async function maskOf(brokerId: string, account: string, appKey: string): Promise<string> {
  const digits = account.replace(/\D/g, '');
  if (digits) return `****${digits.slice(-4)}`;
  const key = appKey.trim();
  if (brokerId === 'kis' || !key) return '';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `키 ${hex.slice(0, 4)}`;
}
