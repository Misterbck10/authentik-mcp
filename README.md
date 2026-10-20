# authentik MCP

Servidor **MCP remoto** (Streamable HTTP) para gerir uma instância **authentik 2026.8 (open source)** a partir de agentes de IA: onboarding/offboarding de colaboradores, aplicações SSO (OIDC, Proxy, SAML, LDAP, RAC, SCIM), administração/diagnóstico e branding completo.

- Next.js (App Router) + `mcp-handler` 2.x + MCP SDK v2 + zod 4, TypeScript strict
- Corre na Vercel (região `fra1`) **ou** em Docker (`next start` / standalone) — ex.: Dokploy
- Tipos gerados do OpenAPI oficial do authentik (`pnpm generate:types`)

## Segurança

| Camada                   | Como funciona                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticação do endpoint | API keys `nome:segredo` em `MCP_API_KEYS`, comparação em tempo constante. Sem key válida → 401.                                                                 |
| Privilégio mínimo        | Token de uma **conta de serviço** com Role dedicado (ver abaixo), nunca de superutilizador.                                                                     |
| Modo só-leitura          | `MCP_READ_ONLY=true` → só são registadas tools de leitura.                                                                                                      |
| Domínios                 | `MCP_ENABLED_DOMAINS` → só os domínios listados. `flows_admin` está desligado por defeito.                                                                      |
| Confirmação              | Tools destrutivas/sensíveis devolvem **dry-run** sem `confirm: true`. Anotações MCP `readOnlyHint` / `destructiveHint` / `idempotentHint`.                      |
| Segredos                 | Redação automática em resultados e logs. `client_secret` só na criação ou via `authentik_providers_get_secret` (confirm). Chaves privadas nunca são devolvidas. |
| Auditoria                | Cada chamada escreve uma linha JSON em stdout: `{type:"audit", timestamp, apiKeyName, tool, argsRedacted, result, durationMs}`.                                 |
| Branding                 | Snapshot automático antes de aplicar; CSS validado (postcss, allowlist de hosts, construções proibidas); SVG sanitizado; brand default protegida.               |

> O authentik tem de estar acessível publicamente por HTTPS para a Vercel o alcançar. Os IPs da Vercel são dinâmicos (sem allowlist de IP em planos gratuitos): a proteção assenta no token de privilégio mínimo e nas API keys.

## Configuração

```bash
cp .env.example .env.local
pnpm install
pnpm dev            # http://localhost:3000  (health: /api/health)
```

| Variável                                                              | Descrição                                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTHENTIK_URL`                                                       | URL pública do authentik                                                                                                                       |
| `AUTHENTIK_TOKEN`                                                     | Token da conta de serviço (**sem expiração**)                                                                                                  |
| `MCP_API_KEYS`                                                        | `nome:segredo[,nome2:segredo2]` — segredos ≥ 32 caracteres (`openssl rand -hex 32`)                                                            |
| `MCP_READ_ONLY`                                                       | `true` para expor só leitura                                                                                                                   |
| `MCP_ENABLED_DOMAINS`                                                 | `users,groups,applications,providers,outposts,flows,events,crypto,policies,sources,rbac,blueprints,system,branding` (+ `flows_admin` opcional) |
| `MCP_MAX_PAGE_ITEMS`                                                  | Teto de itens por listagem (default 200)                                                                                                       |
| `MCP_BRANDING_MAX_CSS_KB` / `MCP_BRANDING_MAX_IMAGE_MB`               | Limites de CSS (100 KB) e imagens (5 MB)                                                                                                       |
| `MCP_BRANDING_ALLOWED_ASSET_HOSTS`                                    | Hosts permitidos em `url()`/`@import` (default Google Fonts)                                                                                   |
| `AUTHENTIK_DEFAULT_AUTH_FLOW` / `AUTHENTIK_DEFAULT_INVALIDATION_FLOW` | Flows por defeito dos providers                                                                                                                |
| `AUTHENTIK_TIMEOUT_MS`                                                | Timeout por pedido ao authentik (default 15000)                                                                                                |

O ambiente é validado com zod no primeiro pedido; uma variável inválida devolve uma mensagem clara (sem valores).

### Conta de serviço com privilégio mínimo

1. **Directory → Users → Create Service Account** (ex.: `svc-mcp`), sem expiração do token.
2. **Directory → Roles → Create** (ex.: `mcp-server`). Em _Permissions → Assign_, dê as permissões globais dos modelos dos domínios que vai ativar, por exemplo:
   - `users`/`groups`: User, Group (view/add/change/delete), Token (view/delete), Authenticated Session (view/delete), Object attribute (view) e as permissões especiais de utilizador (reset password, adicionar/remover de grupos)
   - `applications`/`providers`/`outposts`: Application, Provider (OAuth2, Proxy, SAML, LDAP, RAC, SCIM), Policy binding, Outpost, Scope/SAML/SCIM property mappings (view), Certificate-key pair (view), Flow (view)
   - `events`: Event, Notification (view) · `crypto`: Certificate-key pair · `policies`: Policy, Expression policy, Policy binding
   - `sources`: Source (view), Schedule (view/send) · `rbac`: Role, Permission · `blueprints`: Blueprint instance
   - `system`: System settings, System info, Task/Worker (view)
   - `branding`: Brand, Flow (change), Prompt, File (add/delete), Application/Source (change)
     Depois de ligado, `authentik_rbac_permissions_list` lista os codenames exatos da sua instância.
3. Crie um grupo (ex.: `mcp-service`), atribua-lhe o Role e adicione `svc-mcp` ao grupo.
4. **Directory → Tokens → Create** para `svc-mcp`, intenção _API_, **Expiring desligado**. Use-o em `AUTHENTIK_TOKEN`.

Ative só os domínios de que precisa (`MCP_ENABLED_DOMAINS`) e dê ao Role só as permissões desses domínios.

## Deploy

**Vercel**: importe o repositório, defina as variáveis de ambiente (Production) e faça deploy. `vercel.json` fixa a região `fra1` e `maxDuration` 60 s na rota MCP.

**Docker / Dokploy**:

```bash
docker build -t authentik-mcp .
docker run -p 3000:3000 --env-file .env authentik-mcp
```

## Ligar clientes

- **Claude Code**
  ```bash
  claude mcp add --transport http authentik https://<dominio>/api/mcp \
    --header "Authorization: Bearer <segredo>"
  ```
- **Claude (web/desktop)**: _Settings → Connectors → Add custom connector_ com o URL `https://<dominio>/api/mcp`. Enquanto a autenticação for por API key, use um cliente que permita headers (Claude Code, `mcp-remote`); o OAuth via authentik (fase 7) permite ligar sem header.
- **Clientes só-stdio** (via `mcp-remote`):
  ```json
  {
    "mcpServers": {
      "authentik": {
        "command": "npx",
        "args": [
          "mcp-remote",
          "https://<dominio>/api/mcp",
          "--header",
          "Authorization:Bearer ${AUTHENTIK_MCP_KEY}"
        ],
        "env": { "AUTHENTIK_MCP_KEY": "<segredo>" }
      }
    }
  }
  ```
- **MCP Inspector**: `npx @modelcontextprotocol/inspector` → Streamable HTTP → `http://localhost:3000/api/mcp` + header `Authorization: Bearer <segredo>`.

## Resources e prompts

- Resources: `authentik://users/{id}`, `authentik://applications/{slug}`, `authentik://flows`, `authentik://brands/{uuid}`, `authentik://branding/css-guide`
- Prompts: `onboard-employee`, `connect-new-app`, `apply-brand-identity`

## Testes

```bash
pnpm test               # unitários (vitest + msw)
pnpm test:integration   # sobe authentik 2026.8.4 + PostgreSQL em Docker e corre
                        # onboard → app OIDC → check_access → offboard e snapshot → tokens → restore
pnpm test:integration:down
pnpm generate:types     # regenera tipos (tag fixa ou --url https://<authentik>/api/v3/schema/)
pnpm docs:tools         # regenera a tabela de tools abaixo
```

## Notas e limitações (authentik 2026.8.4)

- **Expiração de policy bindings**: o campo `expires` é só leitura na API (é gerido pelo authentik); as tools mostram-no mas não o definem.
- **Sync LDAP**: não há endpoint direto; `authentik_sources_ldap_sync` dispara os _task schedules_ associados à source.
- **Templates de email**: só se pode escolher um template existente; templates HTML próprios exigem montar ficheiros em `/templates` no servidor.
- **Grupo em convites**: o convite não define grupos; configure o _User Write stage_ do flow de enrollment.
- **Snapshots de branding**: guardados na Files API (`mcp-backups/…`, nome com sufixo aleatório). Ficheiros de media são servidos publicamente; os snapshots não contêm segredos.

## Requer Enterprise (não implementado)

Esta versão visa a edição open source (`AUTHENTIK_EDITION = "oss"` em `src/lib/config/edition.ts`). Ficam de fora:

- `/enterprise/license/*` (licenças)
- Providers Google Workspace, Microsoft Entra, WS-Federation e SSF (`/providers/google_workspace*`, `/providers/microsoft_entra*`, `/providers/wsfed/*`, `/providers/ssf/*`)
- Dynamic client registration (`/providers/oauth2-dcr/*`)
- Object lifecycle management e scheduled user offboarding (`/lifecycle/*`)
- Agent accounts, privileged access requests (`flow_request` da brand), event maps
- Política `unique_password`

## Tools

| Domain       | Tool                                          | Type                          | Purpose                                              |
| ------------ | --------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| users        | `authentik_users_list`                        | read                          | List users                                           |
| users        | `authentik_users_get`                         | read                          | Get user                                             |
| users        | `authentik_users_attribute_definitions`       | read                          | List user attribute definitions                      |
| users        | `authentik_users_create`                      | write                         | Create user                                          |
| users        | `authentik_users_update`                      | write                         | Update user                                          |
| users        | `authentik_users_activate`                    | write                         | Activate user                                        |
| users        | `authentik_users_deactivate`                  | write                         | Deactivate user                                      |
| users        | `authentik_users_delete`                      | write · destructive (confirm) | Delete user                                          |
| users        | `authentik_users_set_password`                | write · destructive (confirm) | Set user password                                    |
| users        | `authentik_users_send_recovery_link`          | write                         | Send password set/recovery link                      |
| users        | `authentik_users_add_to_group`                | write                         | Add user to group                                    |
| users        | `authentik_users_remove_from_group`           | write · destructive (confirm) | Remove user from group                               |
| users        | `authentik_users_list_sessions`               | read                          | List user sessions                                   |
| users        | `authentik_users_revoke_sessions`             | write · destructive (confirm) | Revoke user sessions                                 |
| users        | `authentik_users_onboard_employee`            | write                         | Onboard employee                                     |
| users        | `authentik_users_offboard_employee`           | write · destructive (confirm) | Offboard employee                                    |
| groups       | `authentik_groups_list`                       | read                          | List groups                                          |
| groups       | `authentik_groups_get`                        | read                          | Get group                                            |
| groups       | `authentik_groups_create`                     | write                         | Create group                                         |
| groups       | `authentik_groups_update`                     | write                         | Update group                                         |
| groups       | `authentik_groups_delete`                     | write · destructive (confirm) | Delete group                                         |
| groups       | `authentik_groups_list_members`               | read                          | List group members                                   |
| groups       | `authentik_groups_add_members`                | write                         | Add members to group                                 |
| groups       | `authentik_groups_remove_members`             | write · destructive (confirm) | Remove members from group                            |
| applications | `authentik_applications_list`                 | read                          | List applications                                    |
| applications | `authentik_applications_get`                  | read                          | Get application                                      |
| applications | `authentik_applications_create_with_provider` | write                         | Create application with provider (SSO)               |
| applications | `authentik_applications_update`               | write                         | Update application                                   |
| applications | `authentik_applications_delete`               | write · destructive (confirm) | Delete application                                   |
| applications | `authentik_applications_check_access`         | read                          | Check application access                             |
| applications | `authentik_applications_list_bindings`        | read                          | List application access bindings                     |
| applications | `authentik_applications_bind`                 | write                         | Restrict application access (bind group/user/policy) |
| applications | `authentik_applications_unbind`               | write · destructive (confirm) | Remove application access binding                    |
| providers    | `authentik_providers_list`                    | read                          | List providers                                       |
| providers    | `authentik_providers_get`                     | read                          | Get provider                                         |
| providers    | `authentik_providers_update`                  | write                         | Update provider                                      |
| providers    | `authentik_providers_create_scim`             | write                         | Create SCIM provisioning                             |
| providers    | `authentik_providers_delete`                  | write · destructive (confirm) | Delete provider                                      |
| providers    | `authentik_providers_get_secret`              | sensitive (confirm)           | Reveal provider secret                               |
| outposts     | `authentik_outposts_list`                     | read                          | List outposts                                        |
| outposts     | `authentik_outposts_get`                      | read                          | Get outpost                                          |
| outposts     | `authentik_outposts_health`                   | read                          | Outpost health                                       |
| outposts     | `authentik_outposts_add_provider`             | write                         | Add provider to outpost                              |
| outposts     | `authentik_outposts_remove_provider`          | write · destructive (confirm) | Remove provider from outpost                         |
| blueprints   | `authentik_blueprints_list`                   | read                          | List blueprints                                      |
| blueprints   | `authentik_blueprints_get`                    | read                          | Get blueprint                                        |
| blueprints   | `authentik_blueprints_apply`                  | write · destructive (confirm) | Apply blueprint                                      |
| crypto       | `authentik_crypto_list`                       | read                          | List certificates                                    |
| crypto       | `authentik_crypto_get`                        | read                          | Get certificate                                      |
| crypto       | `authentik_crypto_generate`                   | write                         | Generate self-signed certificate                     |
| crypto       | `authentik_crypto_expiring`                   | read                          | Certificates expiring soon                           |
| events       | `authentik_events_list`                       | read                          | List audit events                                    |
| events       | `authentik_events_get`                        | read                          | Get event                                            |
| events       | `authentik_events_top_per_user`               | read                          | Top events per user                                  |
| events       | `authentik_events_notifications_list`         | read                          | List notifications                                   |
| events       | `authentik_events_audit_user_activity`        | read                          | Summarise user activity                              |
| flows        | `authentik_flows_list`                        | read                          | List flows                                           |
| flows        | `authentik_flows_get`                         | read                          | Get flow                                             |
| flows        | `authentik_flows_bindings_list`               | read                          | List flow stage bindings                             |
| flows        | `authentik_stages_list`                       | read                          | List stages                                          |
| flows        | `authentik_invitations_create`                | write                         | Create invitation                                    |
| flows        | `authentik_invitations_list`                  | read                          | List invitations                                     |
| flows        | `authentik_invitations_delete`                | write · destructive (confirm) | Delete invitation                                    |
| flows_admin  | `authentik_flows_bindings_create`             | write · destructive (confirm) | Bind stage to flow                                   |
| flows_admin  | `authentik_flows_bindings_update`             | write · destructive (confirm) | Update flow stage binding                            |
| flows_admin  | `authentik_flows_bindings_delete`             | write · destructive (confirm) | Remove stage from flow                               |
| flows_admin  | `authentik_stages_invitation_create`          | write                         | Create invitation stage                              |
| policies     | `authentik_policies_list`                     | read                          | List policies                                        |
| policies     | `authentik_policies_get`                      | read                          | Get policy                                           |
| policies     | `authentik_policies_bindings_list`            | read                          | List policy bindings                                 |
| policies     | `authentik_policies_create_expression_policy` | write                         | Create expression policy                             |
| policies     | `authentik_policies_bind`                     | write                         | Bind policy/group/user to object                     |
| policies     | `authentik_policies_unbind`                   | write · destructive (confirm) | Delete policy binding                                |
| policies     | `authentik_policies_test`                     | read                          | Test policy                                          |
| rbac         | `authentik_rbac_roles_list`                   | read                          | List roles                                           |
| rbac         | `authentik_rbac_permissions_list`             | read                          | Find permissions                                     |
| rbac         | `authentik_rbac_roles_create`                 | write                         | Create role                                          |
| rbac         | `authentik_rbac_roles_assign_permissions`     | write · destructive (confirm) | Grant permissions to role                            |
| rbac         | `authentik_rbac_roles_assign_to_group`        | write · destructive (confirm) | Assign role to group                                 |
| sources      | `authentik_sources_list`                      | read                          | List sources                                         |
| sources      | `authentik_sources_get`                       | read                          | Get source                                           |
| sources      | `authentik_sources_ldap_sync_status`          | read                          | LDAP sync status                                     |
| sources      | `authentik_sources_ldap_sync`                 | write · destructive (confirm) | Trigger LDAP sync                                    |
| system       | `authentik_system_info`                       | read                          | System info                                          |
| system       | `authentik_system_version`                    | read                          | Version                                              |
| system       | `authentik_system_workers_status`             | read                          | Worker status                                        |
| system       | `authentik_system_tasks_list`                 | read                          | List background tasks                                |
| system       | `authentik_system_settings_get`               | read                          | Get system settings                                  |
| system       | `authentik_system_settings_update`            | write · destructive (confirm) | Update system settings                               |
| branding     | `authentik_branding_brands_list`              | read                          | List brands                                          |
| branding     | `authentik_branding_brands_get`               | read                          | Get brand                                            |
| branding     | `authentik_branding_brands_create`            | write                         | Create brand                                         |
| branding     | `authentik_branding_brands_update`            | write · destructive (confirm) | Update brand                                         |
| branding     | `authentik_branding_brands_delete`            | write · destructive (confirm) | Delete brand                                         |
| branding     | `authentik_branding_set_theme_defaults`       | write · destructive (confirm) | Set brand theme and language                         |
| branding     | `authentik_branding_set_user_theme`           | write                         | Set a user's theme and language                      |
| branding     | `authentik_branding_apply_design_tokens`      | write · destructive (confirm) | Apply brand design tokens                            |
| branding     | `authentik_branding_set_custom_css`           | write · destructive (confirm) | Set custom CSS                                       |
| branding     | `authentik_branding_get_effective_css`        | read                          | Get brand CSS                                        |
| branding     | `authentik_branding_files_list`               | read                          | List stored files                                    |
| branding     | `authentik_branding_files_upload`             | write                         | Upload image                                         |
| branding     | `authentik_branding_files_delete`             | write · destructive (confirm) | Delete stored file                                   |
| branding     | `authentik_branding_applications_set_icon`    | write                         | Set application icon                                 |
| branding     | `authentik_branding_sources_set_icon`         | write                         | Set source icon                                      |
| branding     | `authentik_branding_flows_customize`          | write · destructive (confirm) | Customise flow appearance                            |
| branding     | `authentik_branding_prompt_fields_list`       | read                          | List form fields                                     |
| branding     | `authentik_branding_prompt_fields_update`     | write · destructive (confirm) | Update form field texts                              |
| branding     | `authentik_branding_email_templates`          | read                          | Email templates (info)                               |
| branding     | `authentik_branding_snapshot`                 | write                         | Snapshot branding                                    |
| branding     | `authentik_branding_restore`                  | write · destructive (confirm) | Restore branding snapshot                            |
| branding     | `authentik_branding_preview_urls`             | read                          | Preview URLs                                         |
| branding     | `authentik_branding_export_blueprint`         | read                          | Export branding as blueprint                         |
