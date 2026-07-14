const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handleOrderRequest(context, routeName) {
  const { request, env, params } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const sheetUrl = env.GOOGLE_SHEETS_WEB_APP_URL || env.GOOGLE_SHEET_WEB_APP_URL;
  if (!sheetUrl) {
    return json(
      {
        success: false,
        error: "Google Sheets endpoint is not configured",
      },
      500,
    );
  }

  try {
    const payload = await readPayload(request);
    const pageId = getPageId(params);
    const order = normalizeOrder(payload, request, pageId, routeName);

    const sheetResponse = await fetch(sheetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(order),
    });

    const responseText = await sheetResponse.text();
    let sheetResult = {};
    try {
      sheetResult = responseText ? JSON.parse(responseText) : {};
    } catch (_error) {
      sheetResult = { raw: responseText };
    }

    if (!sheetResponse.ok || sheetResult.success === false || sheetResult.ok === false) {
      return json(
        {
          success: false,
          error: "Google Sheets rejected the order",
          detail: sheetResult.error || sheetResult.raw || responseText,
        },
        502,
      );
    }

    return json({
      success: true,
      order: toWebcakeOrder(order),
      sheet: sheetResult,
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "Could not process order",
        detail: String(error && error.message ? error.message : error),
      },
      500,
    );
  }
}

async function readPayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const text = await request.text();
  if (!text) return {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const out = {};
    const params = new URLSearchParams(text);
    for (const [key, value] of params.entries()) {
      out[key] = parseMaybeJson(value);
    }
    return out;
  }

  return parseMaybeJson(text);
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function getPageId(params) {
  const path = params && params.path;
  if (Array.isArray(path)) return path[0] || "";
  return path || "";
}

function normalizeOrder(payload, request, pageId, routeName) {
  const formData = payload.form_data || {};
  const id = `gs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fields = extractFields(formData);

  const fullName = firstValue(fields, formData, payload, [
    "full_name",
    "fullname",
    "name",
    "customer_name",
    "ho_ten",
  ]);
  const phoneNumber = firstValue(fields, formData, payload, [
    "phone_number",
    "phone",
    "mobile",
    "customer_phone",
    "so_dien_thoai",
  ]);
  const address = firstValue(fields, formData, payload, [
    "address",
    "customer_address",
    "dia_chi",
  ]);
  const packageName = firstValue(fields, formData, payload, [
    "checkbox_group_1",
    "package",
    "product",
    "variant",
    "goi_mua",
  ]);
  const pricing = inferPricing(packageName);

  return {
    id,
    created_at: new Date().toISOString(),
    route: routeName,
    page_id: pageId,
    form_id: payload.form_id || "",
    full_name: fullName,
    phone_number: phoneNumber,
    address,
    package: packageName,
    total_price: payload.total_price || pricing.total_price,
    shipping_fee: payload.shipping_fee || pricing.shipping_fee,
    country_code: payload.country_code || "",
    from_url: payload.from_url || request.headers.get("referer") || "",
    referrer_url: payload.referrer_url || "",
    useragent: payload.useragent || request.headers.get("user-agent") || "",
    utm_source: payload.utm_source || "",
    utm_medium: payload.utm_medium || "",
    utm_campaign: payload.utm_campaign || "",
    utm_term: payload.utm_term || "",
    utm_content: payload.utm_content || "",
    aff: payload.aff || "",
    fields,
    raw_payload: payload,
  };
}

function inferPricing(packageName) {
  const text = normalizeText(packageName);

  if (text.includes("150k") || text.includes("150.000") || text.includes("3 lo")) {
    return { total_price: 150000, shipping_fee: 0 };
  }

  if (
    text.includes("120k") ||
    text.includes("120.000") ||
    text.includes("99k") ||
    text.includes("99.000")
  ) {
    return { total_price: 120000, shipping_fee: 20000 };
  }

  return { total_price: "", shipping_fee: "" };
}

function normalizeText(value) {
  return formatValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function extractFields(formData) {
  const fields = {};

  if (!formData) return fields;

  if (Array.isArray(formData)) {
    for (const item of formData) {
      if (!item || typeof item !== "object") continue;
      const key = item.field_name || item.name || item.key || item.id || item.label;
      const value = item.value ?? item.answer ?? item.text ?? item.selected;
      if (key && value !== undefined && value !== null) {
        fields[key] = formatValue(value);
      }
    }
    return fields;
  }

  if (typeof formData === "object") {
    for (const [key, value] of Object.entries(formData)) {
      fields[key] = formatValue(value);
    }
  }

  return fields;
}

function firstValue(fields, formData, payload, keys) {
  for (const key of keys) {
    const direct = fields[key] ?? formData[key] ?? payload[key];
    const value = formatValue(direct);
    if (value) return value;
  }

  const found = findNestedValue(formData, keys) || findNestedValue(payload, keys);
  return formatValue(found);
}

function findNestedValue(input, keys) {
  const stack = [input];
  const seen = new Set();

  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);

    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null) return item[key];
    }

    for (const value of Object.values(item)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return "";
}

function formatValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(" | ");
  if (typeof value === "object") {
    if (value.name !== undefined) return formatValue(value.name);
    if (value.value !== undefined) return formatValue(value.value);
    if (value.label !== undefined) return formatValue(value.label);
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function toWebcakeOrder(order) {
  return {
    id: order.id,
    status: 1,
    fields: {
      email: "",
      full_name: order.full_name,
      phone_number: order.phone_number,
      address: order.address,
      checkbox_group_1: order.package,
    },
    full_name: order.full_name,
    phone_number: order.phone_number,
    address: order.address,
    province_id: "",
    total_price: order.total_price || 0,
    shipping_fee: order.shipping_fee || 0,
    source: "google_sheets",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
