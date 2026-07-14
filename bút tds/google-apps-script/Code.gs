const SHEET_NAME = "DonHang";

const HEADERS = [
  "Thoi gian",
  "Ma don",
  "Ho ten",
  "So dien thoai",
  "Dia chi",
  "Goi mua",
  "Tong tien",
  "Phi ship",
  "Form ID",
  "Page ID",
  "UTM source",
  "UTM medium",
  "UTM campaign",
  "UTM term",
  "UTM content",
  "Aff",
  "URL",
  "Referrer",
  "User agent",
];

function doGet() {
  return jsonOutput({ ok: true, message: "Google Sheet order endpoint is ready." });
}

function doPost(e) {
  try {
    const order = parseOrder(e);
    const sheet = getSheet();

    sheet.appendRow([
      order.created_at || new Date().toISOString(),
      order.id || "",
      order.full_name || "",
      order.phone_number || "",
      order.address || "",
      order.package || "",
      order.total_price || "",
      order.shipping_fee || "",
      order.form_id || "",
      order.page_id || "",
      order.utm_source || "",
      order.utm_medium || "",
      order.utm_campaign || "",
      order.utm_term || "",
      order.utm_content || "",
      order.aff || "",
      order.from_url || "",
      order.referrer_url || "",
      order.useragent || "",
    ]);

    return jsonOutput({ ok: true, success: true, id: order.id || "" });
  } catch (error) {
    return jsonOutput({ ok: false, success: false, error: String(error) });
  }
}

function parseOrder(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  return JSON.parse(raw);
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  return sheet;
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
