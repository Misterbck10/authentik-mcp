import { brandsCreate, brandsDelete, brandsGet, brandsList, brandsUpdate } from "./brands";
import { applyDesignTokens, getEffectiveCss, setCustomCss } from "./css";
import { filesDelete, filesList, filesUpload } from "./files";
import { emailTemplatesInfo, flowsCustomize, promptFieldsList, promptFieldsUpdate } from "./flows";
import { applicationsSetIcon, sourcesSetIcon } from "./icons";
import {
  brandingExportBlueprint,
  brandingPreviewUrls,
  brandingRestore,
  brandingSnapshot,
} from "./snapshots";
import { setThemeDefaults, setUserTheme } from "./theme";

export const brandingTools = [
  brandsList,
  brandsGet,
  brandsCreate,
  brandsUpdate,
  brandsDelete,
  setThemeDefaults,
  setUserTheme,
  applyDesignTokens,
  setCustomCss,
  getEffectiveCss,
  filesList,
  filesUpload,
  filesDelete,
  applicationsSetIcon,
  sourcesSetIcon,
  flowsCustomize,
  promptFieldsList,
  promptFieldsUpdate,
  emailTemplatesInfo,
  brandingSnapshot,
  brandingRestore,
  brandingPreviewUrls,
  brandingExportBlueprint,
];
