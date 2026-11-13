(function(root) {
  // Vercel/proxy failures can be text/HTML rather than our API's JSON envelope.
  async function read(response) {
    let data = null;
    try { data = await response.json(); } catch { /* handled below */ }
    const requestId = String(response.headers?.get('x-vercel-id') || '').replace(/[^a-zA-Z0-9:;_.-]/g, '').slice(0, 160);
    if (!response.ok) {
      const error = data && typeof data.error === 'object' && data.error;
      if (error && typeof error.code === 'string' && typeof error.message === 'string') {
        throw { ...error, status: response.status, requestId };
      }
      const platformCode = String(response.headers?.get('x-vercel-error') || '');
      const labels = {
        FUNCTION_INVOCATION_FAILED: 'Hàm máy chủ bị lỗi khi thực thi.',
        FUNCTION_INVOCATION_TIMEOUT: 'Hàm máy chủ vượt thời gian thực thi.',
        FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE: 'Phản hồi máy chủ vượt giới hạn kích thước.',
      };
      throw {
        code: 'invalid_api_response', status: response.status, requestId,
        message: `Máy chủ trả HTTP ${response.status} ngoài định dạng lỗi của ứng dụng. ${labels[platformCode] || 'Cần kiểm tra Vercel Logs của yêu cầu này.'}${requestId ? ' Mã yêu cầu Vercel: ' + requestId : ''}`,
      };
    }
    if (!data || typeof data !== 'object') throw {
      code: 'invalid_api_response', status: response.status, requestId,
      message: 'Máy chủ không trả JSON hợp lệ; lượt chạy AI đã dừng để kiểm tra.',
    };
    return data;
  }
  root.CheckAIResponse = { read };
})(globalThis);
