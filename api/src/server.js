import 'dotenv/config';
import app from './app.js';
const port=Number(process.env.PORT)||4000;
const server=app.listen(port,'0.0.0.0',()=>console.log(`GetLearny API listening on ${port}`));
const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
