import { groupsCreate } from "./create";
import { groupsDelete } from "./delete";
import { groupsGet } from "./get";
import { groupsList } from "./list";
import { groupsAddMembers, groupsListMembers, groupsRemoveMembers } from "./members";
import { groupsUpdate } from "./update";

export const groupTools = [
  groupsList,
  groupsGet,
  groupsCreate,
  groupsUpdate,
  groupsDelete,
  groupsListMembers,
  groupsAddMembers,
  groupsRemoveMembers,
];
