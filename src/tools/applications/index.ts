import { applicationsBind, applicationsListBindings, applicationsUnbind } from "./bindings";
import { applicationsCreateWithProvider } from "./create-with-provider";
import {
  applicationsCheckAccess,
  applicationsDelete,
  applicationsGet,
  applicationsList,
  applicationsUpdate,
} from "./crud";

export const applicationTools = [
  applicationsList,
  applicationsGet,
  applicationsCreateWithProvider,
  applicationsUpdate,
  applicationsDelete,
  applicationsCheckAccess,
  applicationsListBindings,
  applicationsBind,
  applicationsUnbind,
];
