const networkErrorPattern = /failed to fetch|fetch failed|network(?: request)? (?:failed|error)|load failed|econnrefused|enotfound|socket hang up|connection refused/i;
const permissionErrorPattern = /not(?:\s+\w+){0,2}\s+authorized|permission denied|forbidden|access denied|unauthorized|无权|没有权限/i;
const sessionErrorPattern = /authentication required|invalid session|session expired|invalid token|jwt expired|登录已过期|会话已过期/i;
const technicalErrorPattern = /combinedgraphqlerrors|cannot query field|graphql|sql(?:state)?|query failed|database|column |table |stack trace|syntax error|internal server error|status code 5\d\d|https?:\/\/|bearer\s|api[_ -]?key|token=/i;

export function toUserFacingError(error: unknown, fallback = '数据加载失败，请稍后重试或联系系统管理员') {
  const rawMessage = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';
  const message = rawMessage.trim();

  if (!message) return fallback;
  if (permissionErrorPattern.test(message)) return '当前账号没有访问该功能的权限';
  if (sessionErrorPattern.test(message)) return '登录状态已过期，请重新登录';
  if (networkErrorPattern.test(message)) return '无法连接管理服务，请检查网络后重试';
  if (technicalErrorPattern.test(message) || message.length > 180) return fallback;

  return message;
}
