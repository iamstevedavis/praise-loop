import { createApiClient } from "./client";
import { appConfig } from "../config";

// Token storage arrives with app sign-in (#85); until then every owner route is
// expected to return 401 and the app stays on the placeholder screen.
export const api = createApiClient({ baseUrl: appConfig.apiBaseUrl });
