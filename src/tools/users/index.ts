import { usersAttributeDefinitions } from "./attribute-definitions";
import { usersCreate } from "./create";
import { usersDelete } from "./delete";
import { usersGet } from "./get";
import { usersAddToGroup, usersRemoveFromGroup } from "./group-membership";
import { usersList } from "./list";
import { usersOffboardEmployee } from "./offboard-employee";
import { usersOnboardEmployee } from "./onboard-employee";
import { usersSendRecoveryLink } from "./send-recovery-link";
import { usersListSessions, usersRevokeSessions } from "./sessions";
import { usersActivate, usersDeactivate } from "./set-active";
import { usersSetPassword } from "./set-password";
import { usersUpdate } from "./update";

export const userTools = [
  usersList,
  usersGet,
  usersAttributeDefinitions,
  usersCreate,
  usersUpdate,
  usersActivate,
  usersDeactivate,
  usersDelete,
  usersSetPassword,
  usersSendRecoveryLink,
  usersAddToGroup,
  usersRemoveFromGroup,
  usersListSessions,
  usersRevokeSessions,
  usersOnboardEmployee,
  usersOffboardEmployee,
];
