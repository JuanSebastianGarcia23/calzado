
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand
} = require("@aws-sdk/lib-dynamodb");

// UUID simple
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TABLE_NAME = process.env.TABLE_NAME || 'calzado';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const buildResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Normaliza entrada (convierte a tipos apropiados) para calzado
function normalizeCalzado(obj) {
  const p = {};
  if (obj.nombre !== undefined) p.nombre = String(obj.nombre);
  if (obj.marca !== undefined) p.marca = String(obj.marca);

  if (obj.precio !== undefined) {
    const n = Number(obj.precio);
    p.precio = Number.isFinite(n) ? n : obj.precio;
  }
  if (obj.talla !== undefined) {
    const n = Number(obj.talla);
    // talla puede ser entero o decimal según tu modelo; lo dejamos como número
    p.talla = Number.isFinite(n) ? n : obj.talla;
  }
  return p;
}

// Construye objeto con campos en el orden solicitado
function buildOrderedCalzado(item) {
  return {
    id: item?.id ?? null,
    nombre: item?.nombre ?? null,
    marca: item?.marca ?? null,
    precio: item?.precio ?? null,
    talla: item?.talla ?? null
  };
}

async function putCalzado(prod) {
  if (!prod.id) prod.id = uuidv4();
  const item = { id: prod.id };
  if (prod.nombre !== undefined) item.nombre = prod.nombre;
  if (prod.marca !== undefined) item.marca = prod.marca;
  if (prod.precio !== undefined) item.precio = prod.precio;
  if (prod.talla !== undefined) item.talla = prod.talla;

  await ddbDocClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

async function getItemById(id) {
  const resp = await ddbDocClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
  return resp.Item;
}

async function scanAll() {
  const resp = await ddbDocClient.send(new ScanCommand({ TableName: TABLE_NAME }));
  return resp.Items || [];
}

async function deleteById(id) {
  await ddbDocClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
  return true;
}

async function updateCalzado(id, updates) {
  if (!updates || Object.keys(updates).length === 0) return;
  const exprParts = [];
  const exprAttrValues = {};
  const exprAttrNames = {};
  let i = 0;
  for (const k of Object.keys(updates)) {
    const valPlaceholder = `:v${i}`;
    const namePlaceholder = `#n${i}`;
    exprParts.push(`${namePlaceholder} = ${valPlaceholder}`);
    exprAttrValues[valPlaceholder] = updates[k];
    exprAttrNames[namePlaceholder] = k;
    i++;
  }
  const UpdateExpression = "SET " + exprParts.join(", ");
  await ddbDocClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues
  }));
}

function detectHttpMethod(event) {
  if (event.httpMethod) return event.httpMethod.toUpperCase();
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method) return event.requestContext.http.method.toUpperCase();
  return null;
}
function parseBody(event) {
  const b = event.body;
  if (!b) return null;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch (e) { return null; }
  }
  return b;
}

exports.handler = async (event) => {
  console.log("Evento recibido:", JSON.stringify(event));
  try {
    const method = detectHttpMethod(event);

    if (method) {
      if (method === "POST") {
        const raw = parseBody(event);
        if (!raw) return buildResponse(400, { error: "Body requerido" });

        const prodNorm = normalizeCalzado(raw);
        const item = await putCalzado(prodNorm);
        return buildResponse(200, { message: "Calzado registrado", calzado: buildOrderedCalzado(item) });
      }

      if (method === "GET") {
        const pathParams = (event.pathParameters && typeof event.pathParameters === "object") ? event.pathParameters : null;
        const query = (event.queryStringParameters && typeof event.queryStringParameters === "object") ? event.queryStringParameters : null;
        let id = null;
        if (pathParams && pathParams.id) id = pathParams.id;
        else if (query && query.id) id = query.id;

        if (id) {
          const item = await getItemById(id);
          if (item) return buildResponse(200, buildOrderedCalzado(item));
          return buildResponse(404, { message: "No encontrado" });
        } else {
          const items = await scanAll();
          const ordered = items.map(i => buildOrderedCalzado(i));
          return buildResponse(200, ordered);
        }
      }

      if (method === "DELETE") {
        const pathParams = (event.pathParameters && typeof event.pathParameters === "object") ? event.pathParameters : null;
        const query = (event.queryStringParameters && typeof event.queryStringParameters === "object") ? event.queryStringParameters : null;
        let id = null;
        if (pathParams && pathParams.id) id = pathParams.id;
        else if (query && query.id) id = query.id;
        if (!id) return buildResponse(400, { error: "Se requiere id para eliminar" });
        await deleteById(id);
        return buildResponse(200, { message: "Calzado Eliminado" });
      }

      if (method === "PUT" || method === "PATCH") {
        const raw = parseBody(event);
        const pathParams = (event.pathParameters && typeof event.pathParameters === "object") ? event.pathParameters : null;
        const query = (event.queryStringParameters && typeof event.queryStringParameters === "object") ? event.queryStringParameters : null;
        let id = null;
        if (pathParams && pathParams.id) id = pathParams.id;
        else if (query && query.id) id = query.id;
        if (!id) return buildResponse(400, { error: "id requerido para update" });
        if (!raw) return buildResponse(400, { error: "body con campos a actualizar requerido" });

        const updates = normalizeCalzado(raw);
        await updateCalzado(id, updates);
        const updated = await getItemById(id);
        return buildResponse(200, { message: "Calzado actualizado", calzado: buildOrderedCalzado(updated) });
      }

      return buildResponse(400, { error: `Método HTTP no soportado: ${method}` });
    }

    // invocation with operation field
    if (event.operation) {
      const op = String(event.operation).toLowerCase();
      if (op === "create") {
        const raw = (event.body && typeof event.body === "object") ? event.body : null;
        if (!raw) return buildResponse(400, { error: "body requerido" });
        const prodNorm = normalizeCalzado(raw);
        const item = await putCalzado(prodNorm);
        return buildResponse(200, { message: "Calzado registrado", calzado: buildOrderedCalzado(item) });
      }
      if (op === "get") {
        const id = event.id;
        if (!id) return buildResponse(400, { error: "id requerido" });
        const item = await getItemById(id);
        if (item) return buildResponse(200, buildOrderedCalzado(item));
        return buildResponse(404, { message: "No encontrado" });
      }
      if (op === "list") {
        const items = await scanAll();
        const ordered = items.map(i => buildOrderedCalzado(i));
        return buildResponse(200, ordered);
      }
      if (op === "delete") {
        const id = event.id;
        if (!id) return buildResponse(400, { error: "id requerido" });
        await deleteById(id);
        return buildResponse(200, { message: "Calzado Eliminado" });
      }
      if (op === "update") {
        const id = event.id;
        if (!id) return buildResponse(400, { error: "id requerido para update" });
        const raw = (event.body && typeof event.body === "object") ? event.body : null;
        if (!raw) return buildResponse(400, { error: "body con campos a actualizar requerido" });
        const updates = normalizeCalzado(raw);
        await updateCalzado(id, updates);
        const updated = await getItemById(id);
        return buildResponse(200, { message: "Calzado actualizado", calzado: buildOrderedCalzado(updated) });
      }
      return buildResponse(400, { error: "Operación inválida. Usa create, get, delete, list, update" });
    }

    return buildResponse(400, { error: "No se pudo interpretar el evento recibido" });
  } catch (err) {
    console.error("Error inesperado:", err);
    return buildResponse(500, { error: String(err) });
  }
};
