/** 사이드카 오류 `{code, message, hint}`(스펙 8장)를 화면이 그대로 보여 줄 수 있게 담는다. */
export class ApiError extends Error {
  readonly code: string;
  readonly hint: string | null;
  /** HTTP 상태. 연결 자체가 안 되었으면 0. */
  readonly status: number;

  constructor(code: string, message: string, hint: string | null, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** 어떤 오류든 화면에 보일 ApiError로. 예상하지 못한 것은 일반 문구로 감싼다. */
export function toApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value;
  return new ApiError(
    'UI_UNEXPECTED',
    '예상하지 못한 오류가 발생했습니다.',
    '화면을 다시 불러오거나 앱을 다시 시작하세요.',
    0,
  );
}
