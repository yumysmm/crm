// Supabase Edge Function: consulta-runt
// Guarda la clave de PlacApi en el servidor (secreto PLACAPI_KEY); el CRM nunca la ve.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SB_URL = () => Deno.env.get('SUPABASE_URL') ?? '';
const SB_SVC = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOPE = () => Number(Deno.env.get('RUNT_TOPE_DIARIO') ?? '300');
const TIPOS = ['CC', 'CE', 'NIT', 'TI', 'PA'];
// Créditos por consulta: básica = 1, completa (SOAT, RTM, SIMIT, impuestos...) = 3
const CREDITOS: Record<string, number> = { basica: 1, completa: 3 };

const hoyBogota = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

async function leerClave(clave: string) {
  const r = await fetch(`${SB_URL()}/rest/v1/crm_config?clave=eq.${encodeURIComponent(clave)}&select=valor`, {
    headers: { apikey: SB_SVC(), Authorization: `Bearer ${SB_SVC()}` },
  });
  if (!r.ok) throw new Error('No se pudo leer crm_config');
  const rows = await r.json();
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].valor); } catch { return null; }
}
async function escribirClave(clave: string, valor: unknown) {
  await fetch(`${SB_URL()}/rest/v1/crm_config`, {
    method: 'POST',
    headers: {
      apikey: SB_SVC(), Authorization: `Bearer ${SB_SVC()}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ clave, valor: JSON.stringify(valor), updated_at: new Date().toISOString() }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const apiKey = Deno.env.get('PLACAPI_KEY');
  const fecha = hoyBogota();

  if (body?.ping) {
    let n = 0;
    try { const u = await leerClave('runt_uso'); if (u && u.fecha === fecha) n = u.n; } catch { /* ignorar */ }
    return json({ ok: true, clave: !!apiKey, usoHoy: n, tope: TOPE() });
  }

  if (!apiKey) return json({ error: 'Falta configurar la clave de PlacApi en el servidor', parar: true }, 500);

  const placa = String(body?.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const docType = String(body?.docType ?? '').toUpperCase();
  const docNumber = String(body?.docNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const modo = body?.modo === 'completa' ? 'completa' : 'basica';
  const peso = CREDITOS[modo];
  if (!/^[A-Z0-9]{5,7}$/.test(placa) || !TIPOS.includes(docType) || !/^[A-Z0-9]{4,15}$/.test(docNumber)) {
    return json({ error: 'Datos inválidos (placa, tipo o número de documento)' }, 400);
  }

  // Solo se consultan pares placa+documento que existen en el CRM
  try {
    const clientes = await leerClave('clientes');
    const ok = Array.isArray(clientes) && clientes.some((c: any) =>
      String(c.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === placa &&
      String(c.docNumero ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') === docNumber);
    if (!ok) return json({ error: 'La placa y el documento no corresponden a un cliente del CRM' }, 403);

    // Tope diario
    const uso = await leerClave('runt_uso');
    const n = uso && uso.fecha === fecha ? uso.n : 0;
    if (n + peso > TOPE()) return json({ error: `Tope diario de créditos alcanzado (${TOPE()})`, parar: true }, 429);
    await escribirClave('runt_uso', { fecha, n: n + peso });
  } catch (e) {
    return json({ error: 'No se pudo validar la solicitud: ' + (e as Error).message }, 500);
  }

  let r: Response;
  try {
    r = await fetch(modo === 'completa' ? 'https://placapi.com/api/consulta-full' : 'https://placapi.com/api/consulta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ placa, docType, docNumber }),
      signal: AbortSignal.timeout(modo === 'completa' ? 55000 : 30000),
    });
  } catch {
    return json({ error: 'PlacApi no respondió a tiempo' }, 504);
  }
  if (r.status === 401 || r.status === 403) return json({ error: 'PlacApi rechazó la clave', parar: true }, 502);
  if (r.status === 402) return json({ error: 'Sin créditos en PlacApi', parar: true }, 402);
  if (r.status === 429) return json({ error: 'PlacApi limitó las consultas, intenta más tarde', parar: true }, 429);
  if (!r.ok) return json({ error: 'PlacApi respondió con error ' + r.status }, 502);
  let data: unknown;
  try { data = await r.json(); } catch { return json({ error: 'Respuesta de PlacApi no válida' }, 502); }
  return json(data);
});
