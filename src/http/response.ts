export type ApiStatus = -1 | 0 | 1 | 2 | 3;

export type ApiEnvelope<T> = {
  status: ApiStatus;
  message: string;
  data: T;
};

export function statusForHttpCode(httpCode: number): ApiStatus {
  if (httpCode >= 200 && httpCode < 300) return 1;
  if (httpCode >= 400 && httpCode < 600) return 0;
  return 0;
}

export function envelope<T>(httpCode: number, message: string, data: T): ApiEnvelope<T> {
  return {
    status: statusForHttpCode(httpCode),
    message,
    data,
  };
}
