import app from './src/app.js';

// Let Express parse JSON and multipart request streams in the serverless runtime.
export const config = { api: { bodyParser: false } };
export default app;
