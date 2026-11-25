const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ---------------------------------------------------------------------------
// Estado inicial de prueba en memoria (se reemplaza por DB + ML en el paso 2)
// ---------------------------------------------------------------------------
const ENVIO_INICIAL = [
  {
    shipment_id: '4500192831',
    order_id: '2000089123456789',
    comprador: 'lucas_gomez92',
    direccion: 'Defensa 850, San Telmo, CABA',
    estado: 'not_delivered',
    motivo: 'Comprador ausente',
    fecha_reprogramada: null,
    franja_horaria: null,
    aviso_enviado: false,
    actualizado_en: null
  },
  {
    shipment_id: '4500192832',
    order_id: '2000089123456790',
    comprador: 'camila_fernandez',
    direccion: 'Av. Caseros 420, San Telmo, CABA',
    estado: 'not_delivered',
    motivo: 'Domicilio cerrado',
    fecha_reprogramada: null,
    franja_horaria: null,
    aviso_enviado: false,
    actualizado_en: null
  },
  {
    shipment_id: '4500192833',
    order_id: '2000089123456791',
    comprador: 'martin_rodriguez',
    direccion: 'Bolívar 1120, San Telmo, CABA',
    estado: 'ready_to_ship',
    motivo: null,
    fecha_reprogramada: null,
    franja_horaria: null,
    aviso_enviado: false,
    actualizado_en: null
  }
];

let enviosFlex = structuredClone(ENVIO_INICIAL);

const FRANJAS_VALIDAS = new Set([
  '09:00 a 12:00 hs',
  '12:00 a 16:00 hs',
  '16:00 a 20:00 hs'
]);

function esFechaValida(fechaStr) {
  if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    return false;
  }
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return (
    fecha.getUTCFullYear() === y &&
    fecha.getUTCMonth() === m - 1 &&
    fecha.getUTCDate() === d
  );
}

// ---------------------------------------------------------------------------
// Ruta principal del panel
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------------------
// Estado de integración (Mercado Libre + Base de Datos)
// ---------------------------------------------------------------------------
app.get('/api/estado-conexion', (req, res) => {
  const mlConfigurado = Boolean(process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET);
  const dbConfigurada = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  res.json({
    modo: mlConfigurado && dbConfigurada ? 'produccion' : 'prueba_local',
    mercado_libre_configurado: mlConfigurado,
    base_datos_configurada: dbConfigurada,
    redirect_uri_sugerida:
      process.env.ML_REDIRECT_URI ||
      'https://flex-reprogramador3.onrender.com/auth/ml/callback'
  });
});

// Base lista para iniciar OAuth con Mercado Libre cuando cargues las variables
app.get('/auth/ml/url', (req, res) => {
  const clientId = process.env.ML_CLIENT_ID;
  const redirectUri =
    process.env.ML_REDIRECT_URI ||
    'https://flex-reprogramador3.onrender.com/auth/ml/callback';

  if (!clientId) {
    return res.status(400).json({
      ok: false,
      error: 'Falta configurar ML_CLIENT_ID en las variables de entorno de Render.'
    });
  }

  const authUrl = new URL('https://auth.mercadolibre.com.ar/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);

  res.json({ ok: true, auth_url: authUrl.toString() });
});

app.get('/auth/ml/callback', (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`Error de autorización en Mercado Libre: ${error}`);
  }
  if (!code) {
    return res.status(400).send('No se recibió el código de autorización (code).');
  }
  res.send(
    'Código OAuth recibido correctamente. En el próximo paso lo intercambiamos por tokens y guardamos en la base de datos.'
  );
});

// ---------------------------------------------------------------------------
// Endpoints de envíos Flex
// ---------------------------------------------------------------------------
app.get('/api/envios', (req, res) => {
  try {
    const { estado = 'todos', q = '' } = req.query;
    const termino = String(q).trim().toLowerCase();

    const filtrados = enviosFlex.filter((envio) => {
      const coincideEstado = estado === 'todos' || envio.estado === estado;
      const coincideTexto =
        !termino ||
        envio.shipment_id.toLowerCase().includes(termino) ||
        envio.order_id.toLowerCase().includes(termino) ||
        envio.comprador.toLowerCase().includes(termino) ||
        envio.direccion.toLowerCase().includes(termino);

      return coincideEstado && coincideTexto;
    });

    res.json({
      ok: true,
      total: enviosFlex.length,
      envios: filtrados
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al obtener los envíos.' });
  }
});

app.post('/api/envios/:shipmentId/reprogramar', (req, res) => {
  try {
    const { shipmentId } = req.params;
    const { fecha_reprogramada, franja_horaria } = req.body || {};

    if (!esFechaValida(fecha_reprogramada)) {
      return res.status(400).json({
        ok: false,
        error: 'Seleccioná una fecha válida.'
      });
    }

    const franjaElegida = FRANJAS_VALIDAS.has(franja_horaria)
      ? franja_horaria
      : '12:00 a 16:00 hs';

    const idx = enviosFlex.findIndex((item) => item.shipment_id === shipmentId);
    if (idx === -1) {
      return res.status(404).json({
        ok: false,
        error: `No se encontró el envío #${shipmentId}.`
      });
    }

    enviosFlex[idx] = {
      ...enviosFlex[idx],
      estado: 'rescheduled',
      fecha_reprogramada,
      franja_horaria: franjaElegida,
      aviso_enviado: true,
      actualizado_en: new Date().toISOString()
    };

    const actualizado = enviosFlex[idx];

    res.json({
      ok: true,
      mensaje: `Envío #${actualizado.shipment_id} reprogramado para el ${actualizado.fecha_reprogramada} (${actualizado.franja_horaria}) y aviso preparado para ${actualizado.comprador}.`,
      envio: actualizado
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo reprogramar el envío.' });
  }
});

app.post('/api/envios/reset-prueba', (req, res) => {
  enviosFlex = structuredClone(ENVIO_INICIAL);
  res.json({
    ok: true,
    mensaje: 'Datos de prueba restaurados a su estado inicial.',
    envios: enviosFlex
  });
});

app.listen(PORT, () => {
  console.log(`Panel Flex escuchando en el puerto ${PORT}`);
});
