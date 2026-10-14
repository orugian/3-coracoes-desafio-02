/* GET /api/v1/xica/status */
import { loadConfig } from "../../../lib/xica.js";
import { statusResponse } from "../../../lib/http.js";

export default {
  fetch(request) {
    return statusResponse(request, loadConfig());
  },
};
