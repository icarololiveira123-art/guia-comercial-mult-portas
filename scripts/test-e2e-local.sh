#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

project_root="$(cd "${script_dir}/.." && pwd)"
port="${MULT_PORTAS_E2E_PORT:-4187}"
origin="http://127.0.0.1:${port}"
run_dir="$(mktemp -d)"
server_log="${run_dir}/server.log"
server_pid=""

cleanup() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
  case "${run_dir}" in
    /tmp/tmp.*|"${project_root}"/.sites-runtime/tmp/tmp.*) rm -r -- "${run_dir}" ;;
    *) echo "Diretório temporário inesperado; limpeza ignorada: ${run_dir}" >&2 ;;
  esac
}
trap cleanup EXIT

cd "${project_root}"
ADMIN_PASSWORD=admin npm run dev -- --host 127.0.0.1 --port "${port}" >"${server_log}" 2>&1 &
server_pid="$!"

ready=0
for _ in $(seq 1 90); do
  if curl --silent --show-error --fail --max-time 2 "${origin}/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "${ready}" != "1" ]]; then
  sed -n '1,220p' "${server_log}" >&2
  echo "A prévia local não ficou pronta para o teste E2E." >&2
  exit 1
fi

suffix="$$-$(date +%s)"
user_a="qa.a.${suffix}"
user_a_edited="qa.a.edit.${suffix}"
user_b="qa.b.${suffix}"
admin_user="qa.admin.${suffix}"
cookie_a="${run_dir}/a.cookie"
cookie_b="${run_dir}/b.cookie"
cookie_admin="${run_dir}/admin.cookie"

request() {
  local method="$1"
  local path="$2"
  local cookie_file="$3"
  local body_file="$4"
  local output_file="$5"
  local data="${6:-}"
  local args=(--silent --show-error --request "${method}" --header "Origin: ${origin}" --cookie "${cookie_file}" --cookie-jar "${cookie_file}" --output "${output_file}" --write-out '%{http_code}')
  if [[ -n "${data}" ]]; then
    args+=(--header 'Content-Type: application/json' --data "${data}")
  fi
  curl "${args[@]}" "${origin}${path}" >"${body_file}"
}

assert_status() {
  local expected="$1"
  local status_file="$2"
  local response_file="$3"
  local actual
  actual="$(cat "${status_file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Status ${actual}; esperado ${expected}. Resposta:" >&2
    sed -n '1,160p' "${response_file}" >&2
    echo "Log do servidor:" >&2
    sed -n '1,220p' "${server_log}" >&2
    exit 1
  fi
}

status="${run_dir}/status"
response="${run_dir}/response.json"

request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"usuario.inexistente.${suffix}\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 401 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.error!=="Usuário ou senha incorretos.") process.exit(1)' "${response}"

request POST /api/auth/login "${cookie_admin}" "${status}" "${response}" '{"username":"admin","password":"admin"}'
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.admin!==true) process.exit(1)' "${response}"
request GET /api/admin/users "${cookie_admin}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(!Array.isArray(d.users)) process.exit(1)' "${response}"

request POST /api/admin/users "${cookie_admin}" "${status}" "${response}" "{\"displayName\":\"QA Administrado\",\"username\":\"${admin_user}\",\"branch\":\"Araraquara\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 201 "${status}" "${response}"
admin_user_id="$(node -p 'const d=require(process.argv[1]); if(!Number.isInteger(d.user?.id)) process.exit(1); d.user.id' "${response}")"

request PATCH "/api/admin/users/${admin_user_id}" "${cookie_admin}" "${status}" "${response}" "{\"displayName\":\"QA Perfil Editado\",\"username\":\"${admin_user}.edit\",\"branch\":\"São Carlos\",\"password\":\"Qa-Teste-2026-Nova!\"}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.user?.displayName!=="QA Perfil Editado" || d.user?.branch!=="São Carlos") process.exit(1)' "${response}"
request GET "/api/admin/users/${admin_user_id}" "${cookie_admin}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.user?.username!==process.argv[2] || d.state!==null) process.exit(1)' "${response}" "${admin_user}.edit"

request POST /api/auth/logout "${cookie_admin}" "${status}" "${response}" '{}'
assert_status 200 "${status}" "${response}"
request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"${admin_user}.edit\",\"password\":\"Qa-Teste-2026-Nova!\"}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.user?.displayName!=="QA Perfil Editado") process.exit(1)' "${response}"
request POST /api/auth/logout "${cookie_a}" "${status}" "${response}" '{}'
assert_status 200 "${status}" "${response}"

request POST /api/auth/login "${cookie_admin}" "${status}" "${response}" '{"username":"admin","password":"admin"}'
assert_status 200 "${status}" "${response}"
request DELETE "/api/admin/users/${admin_user_id}" "${cookie_admin}" "${status}" "${response}" '{}'
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.ok!==true) process.exit(1)' "${response}"
request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"${admin_user}.edit\",\"password\":\"Qa-Teste-2026-Nova!\"}"
assert_status 401 "${status}" "${response}"

request POST /api/auth/register "${cookie_a}" "${status}" "${response}" "{\"displayName\":\"QA Funcionário A\",\"username\":\"${user_a}\",\"branch\":\"Araraquara\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 201 "${status}" "${response}"

request GET /api/data "${cookie_a}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.state!==null) process.exit(1)' "${response}"

state_payload='{"state":{"metrics":{"leads":4,"quotes":3,"officialQuotes":2,"incompleteQuotes":1,"followups":1,"closed":1,"ticket":2500},"training":{"rounds":2,"best":8,"scenarios":["price-first"],"scoreHistory":[6,8],"skillHistory":[{"acolhimento":7,"diagnostico":6,"precisao":7,"valor":6,"proximoPasso":8}]},"followups":[{"id":"qa-1","client":"Cliente QA","next":"Retornar amanhã","priority":"Alta","done":false}]}}'
request PUT /api/data "${cookie_a}" "${status}" "${response}" "${state_payload}"
assert_status 200 "${status}" "${response}"

request POST /api/auth/logout "${cookie_a}" "${status}" "${response}" '{}'
assert_status 200 "${status}" "${response}"
request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"${user_a}\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 200 "${status}" "${response}"
request GET /api/data "${cookie_a}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.state?.metrics?.quotes!==3 || d.state?.training?.scoreHistory?.join(",")!=="6,8") process.exit(1)' "${response}"

request PATCH /api/auth/profile "${cookie_a}" "${status}" "${response}" "{\"displayName\":\"QA Funcionário A Editado\",\"username\":\"${user_a_edited}\",\"branch\":\"São Carlos\",\"currentPassword\":\"Qa-Teste-2026!\",\"newPassword\":\"Qa-Teste-2026-Nova!\"}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.user?.displayName!=="QA Funcionário A Editado" || d.user?.branch!=="São Carlos" || d.user?.username!==process.argv[2]) process.exit(1)' "${response}" "${user_a_edited}"
request GET /api/data "${cookie_a}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.state?.metrics?.quotes!==3 || d.state?.followups?.[0]?.client!=="Cliente QA") process.exit(1)' "${response}"
request POST /api/auth/logout "${cookie_a}" "${status}" "${response}" '{}'
assert_status 200 "${status}" "${response}"
request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"${user_a}\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 401 "${status}" "${response}"
request POST /api/auth/login "${cookie_a}" "${status}" "${response}" "{\"username\":\"${user_a_edited}\",\"password\":\"Qa-Teste-2026-Nova!\"}"
assert_status 200 "${status}" "${response}"
request GET /api/data "${cookie_a}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.state?.metrics?.quotes!==3 || d.state?.training?.best!==8) process.exit(1)' "${response}"

request POST /api/auth/register "${cookie_b}" "${status}" "${response}" "{\"displayName\":\"QA Funcionário B\",\"username\":\"${user_b}\",\"branch\":\"São Carlos\",\"password\":\"Qa-Teste-2026!\"}"
assert_status 201 "${status}" "${response}"
request GET /api/data "${cookie_b}" "${status}" "${response}"
assert_status 200 "${status}" "${response}"
node -e 'const d=require(process.argv[1]); if(d.state!==null) process.exit(1)' "${response}"

blocked_status="$(curl --silent --show-error --output "${response}" --write-out '%{http_code}' --request POST --header 'Origin: https://example.invalid' --header 'Content-Type: application/json' --data '{"username":"admin","password":"admin"}' "${origin}/api/auth/login")"
if [[ "${blocked_status}" != "403" ]]; then
  echo "Origem externa recebeu ${blocked_status}; esperado 403." >&2
  exit 1
fi

echo "E2E local aprovado: admin, CRUD e autoedição de perfis, redefinição de senha, cadastro zerado, persistência, isolamento e bloqueio de origem externa."
