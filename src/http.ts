import { buildApp } from './app.js';
import { PORT } from './config.js';

buildApp().listen(PORT, () => {
  console.log(`swop-mcp listening on :${PORT} (POST /mcp)`);
});
