/** 클래스 이름을 이어 붙인다. 거짓 값은 건너뛴다. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
