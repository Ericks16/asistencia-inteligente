import { join } from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { createApplication } from './app-factory';

async function bootstrap() {
  const app = await createApplication();

  // HTTPS con certificado autofirmado: necesario para que el navegador permita
  // cámara (getUserMedia) y GPS (geolocation) cuando se accede vía IP de red.
  const pfxPath = join(__dirname, '..', 'certs', 'server.pfx');
  if (fs.existsSync(pfxPath)) {
    const httpsOptions = {
      pfx: fs.readFileSync(pfxPath),
      passphrase: process.env.PFX_PASSPHRASE ?? 'asistencia123',
    };
    const expressApp = app.getHttpAdapter().getInstance();
    https.createServer(httpsOptions, expressApp).listen(3443, '0.0.0.0', () => {
      // eslint-disable-next-line no-console
      console.log('HTTPS escuchando en https://0.0.0.0:3443');
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API Asistencia Inteligente escuchando en :${port}`);
}
bootstrap();
