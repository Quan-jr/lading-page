import { handleOrderRequest } from "../_shared/google-sheet-order.js";

export function onRequest(context) {
  return handleOrderRequest(context, "create_form_data");
}
