const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TIENE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

app.use(express.json());
app.use(express.static(__dirname));

const DATOS_PRUEBA_INICIALES = [
  {
    shipment_id: '4500192831',
    order_id: '2000089123456789',
    comprador: 'lucas_gomez92',
    direccion: 'Defensa 850, San Telmo, CABA',
    estado: 'not_delivered',
    motivo: 'Comprador ausente',
    fecha_reprogramada: null,
    franja_horaria: null,
    aviso_enviado: false
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
    aviso_enviado: false
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
    aviso_enviado: false
  }
];

let enviosMemoria = JSON.parse(JSON.stringify(DATOS_PRUEBA_INICIALES));

function esFechaValida(fechaStr) {
  if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
    return false;
  }
  const [anio, mes, dia] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

async function supabaseFetch(endpoint, options = {}) {
  if (!TIENE_SUPABASE) {
    throw new Error('Variables de Supabase no configuradas');
  }

  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const resp = await fetch(url, {
    ...options,
    headers
  });

  const texto = await resp.text();
  let data = null;
  if (texto) {
    try {
      data = JSON.parse(texto);
    } catch {
      data = texto;
    }
  }

  if (!resp.ok) {
    const detalle =
      (data && (data.message || data.error_description || data.hint)) ||
      `HTTP ${resp.status}`;
    throw new Error(`Supabase error: ${detalle}`);
  }

  return data;
}

async function obtenerEnviosDB() {
  if (!TIENE_SUPABASE) {
    return { envios: enviosMemoria, fuente: 'memoria' };
  }

  const filas = await supabaseFetch(
    'envios_flex?select=*&order=shipment_id.asc',
    { method: 'GET' }
  );

  return {
    envios: Array.isArray(filas) ? filas : [],
    fuente: 'supabase'
  };
}

async function verificarConexionSupabase() {
  if (!TIENE_SUPABASE) {
    return { conectada: false, detalle: 'Faltan variables de entorno' };
  }
  try {
    await supabaseFetch('envios_flex?select=shipment_id&limit=1', {
      method: 'GET'
    });
    return { conectada: true, detalle: 'Conectada a PostgreSQL (Supabase)' };
  } catch (err) {
    return { conectada: false, detalle: err.message };
  }
}

async function verificarCuentaML() {
  if (!TIENE_SUPABASE) {
    return { vinculada: false, ml_user_id: null };
  }
  try {
    const filas = await supabaseFetch(
      "ml_cuentas?id=eq.proveedor_principal&select=ml_user_id,access_token,expires_at&limit=1",
      { method: 'GET' }
    );
    const cuenta = Array.isArray(filas) && filas[0] ? filas[0] : null;
    const vinculada = Boolean(cuenta && cuenta.access_token);
    return {
      vinculada,
      ml_user_id: cuenta ? cuenta.ml_user_id : null
    };
  } catch {
    return { vinculada: false, ml_user_id: null };
  }
}

app.get('/api/estado', async (_req, res) => {
  const [db, ml] = await Promise.all([
    verificarConexionSupabase(),
    verificarCuentaML()
  ]);

  res.json({
    ok: true,
    modo: ml.vinculada ? 'produccion' : 'prueba',
    base_datos: db.conectada ? 'conectada' : 'pendiente',
    base_datos_detalle: db.detalle,
    mercado_libre: ml.vinculada ? 'vinculada' : 'pendiente',
    ml_user_id: ml.ml_user_id
  });
});

app.get('/api/envios', async (_req, res) => {
  try {
    const resultado = await obtenerEnviosDB();
    res.json({
      ok: true,
      fuente: resultado.fuente,
      envios: resultado.envios
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: `No se pudieron cargar los envíos: ${err.message}`,
      envios: enviosMemoria
    });
  }
});

async function manejarReprogramacion(req, res) {
  const shipmentId = String(
    req.params.shipment_id || req.body.shipment_id || ''
  ).trim();
  const fechaReprogramada = String(req.body.fecha_reprogramada || '').trim();
  const franjaHoraria = String(
    req.body.franja_horaria || '09:00 a 12:00 hs'
  ).trim();

  if (!shipmentId) {
    return res.status(400).json({ ok: false, error: 'Falta el ID de envío.' });
  }

  if (!esFechaValida(fechaReprogramada)) {
    return res
      .status(400)
      .json({ ok: false, error: 'Seleccioná una fecha válida.' });
  }

  const ahoraIso = new Date().toISOString();

  if (TIENE_SUPABASE) {
    try {
      const actualizados = await supabaseFetch(
        `envios_flex?shipment_id=eq.${encodeURIComponent(shipmentId)}`,
        {
          method: 'PATCH',
          headers: {
            Prefer: 'return=representation'
          },
          body: JSON.stringify({
            estado: 'rescheduled',
            fecha_reprogramada: fechaReprogramada,
            franja_horaria: franjaHoraria,
            aviso_enviado: true,
            actualizado_en: ahoraIso
          })
        }
      );

      if (!Array.isArray(actualizados) || actualizados.length === 0) {
        return res
          .status(404)
          .json({ ok: false, error: 'Envío no encontrado en la base de datos.' });
      }

      const envio = actualizados[0];
      return res.json({
        ok: true,
        fuente: 'supabase',
        mensaje: `Envío #${envio.shipment_id} reprogramado para el ${fechaReprogramada} (${franjaHoraria}) y aviso preparado para ${envio.comprador}.`,
        envio
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: `Error guardando en Supabase: ${err.message}`
      });
    }
  }

  const idx = enviosMemoria.findIndex((e) => e.shipment_id === shipmentId);
  if (idx === -1) {
    return res.status(404).json({ ok: false, error: 'Envío no encontrado.' });
  }

  enviosMemoria[idx] = {
    ...enviosMemoria[idx],
    estado: 'rescheduled',
    fecha_reprogramada: fechaReprogramada,
    franja_horaria: franjaHoraria,
    aviso_enviado: true,
    actualizado_en: ahoraIso
  };

  const envio = enviosMemoria[idx];
  return res.json({
    ok: true,
    fuente: 'memoria',
    mensaje: `Envío #${envio.shipment_id} reprogramado para el ${fechaReprogramada} (${franjaHoraria}) y aviso preparado para ${envio.comprador}.`,
    envio
  });
}

app.post('/api/reprogramar', manejarReprogramacion);
app.post('/api/envios/:shipment_id/reprogramar', manejarReprogramacion);

app.post('/api/restaurar', async (_req, res) => {
  enviosMemoria = JSON.parse(JSON.stringify(DATOS_PRUEBA_INICIALES));

  if (TIENE_SUPABASE) {
    try {
      const ahoraIso = new Date().toISOString();
      const filasReset = DATOS_PRUEBA_INICIALES.map((item) => ({
        ...item,
        actualizado_en: ahoraIso
      }));

      await supabaseFetch('envios_flex?on_conflict=shipment_id', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(filasReset)
      });

      const resultado = await obtenerEnviosDB();
      return res.json({
        ok: true,
        fuente: 'supabase',
        mensaje: 'Datos de prueba restaurados en Supabase.',
        envios: resultado.envios
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: `No se pudieron restaurar los datos en Supabase: ${err.message}`
      });
    }
  }

  return res.json({
    ok: true,
    fuente: 'memoria',
    mensaje: 'Datos de prueba restaurados en memoria.',
    envios: enviosMemoria
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(
    `Servidor Flex Reprogramador activo en puerto ${PORT} | Supabase: ${
      TIENE_SUPABASE ? 'CONFIGURADO' : 'NO CONFIGURADO'
    }`
  );
});
