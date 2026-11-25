const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Base de prueba en memoria (luego se conecta directo a Mercado Libre OAuth + Supabase)
let enviosFlex = [
    {
        shipment_id: '4500192831',
        order_id: '2000089123456789',
        comprador: 'lucas_gomez92',
        direccion: 'Defensa 850, San Telmo, CABA',
        estado: 'not_delivered',
        motivo: 'Comprador ausente',
        fecha_reprogramada: null,
        franja_horaria: null
    },
    {
        shipment_id: '4500192832',
        order_id: '2000089123456790',
        comprador: 'camila_fernandez',
        direccion: 'Av. Caseros 420, San Telmo, CABA',
        estado: 'not_delivered',
        motivo: 'Domicilio cerrado',
        fecha_reprogramada: null,
        franja_horaria: null
    },
    {
        shipment_id: '4500192833',
        order_id: '2000089123456791',
        comprador: 'martín_rodriguez',
        direccion: 'Bolívar 1120, San Telmo, CABA',
        estado: 'ready_to_ship',
        motivo: null,
        fecha_reprogramada: null,
        franja_horaria: null
    }
];

// Obtener todos los envíos Flex
app.get('/api/envios-flex', (req, res) => {
    res.json({ total: enviosFlex.length, envios: enviosFlex });
});

// Reprogramar envío Flex
app.post('/api/reprogramar', (req, res) => {
    const { shipmentId, nuevaFecha, franjaHoraria } = req.body;

    if (!shipmentId || !nuevaFecha || !franjaHoraria) {
        return res.status(400).json({ error: 'Completá fecha y franja horaria' });
    }

    const envio = enviosFlex.find(e => e.shipment_id === String(shipmentId));
    if (!envio) {
        return res.status(404).json({ error: 'Envío no encontrado' });
    }

    envio.estado = 'rescheduled';
    envio.fecha_reprogramada = nuevaFecha;
    envio.franja_horaria = franjaHoraria;

    res.json({
        ok: true,
        mensaje: `Envío #${shipmentId} reprogramado para el ${nuevaFecha} (${franjaHoraria}) y aviso preparado para ${envio.comprador}.`,
        envio
    });
});

app.listen(PORT, () => {
    console.log(`✅ Servidor Flex listo en: http://localhost:${PORT}`);
});
