import { providersCreateScim } from "./create-scim";
import {
  providersDelete,
  providersGet,
  providersGetSecret,
  providersList,
  providersUpdate,
} from "./tools";

export const providerTools = [
  providersList,
  providersGet,
  providersUpdate,
  providersCreateScim,
  providersDelete,
  providersGetSecret,
];
