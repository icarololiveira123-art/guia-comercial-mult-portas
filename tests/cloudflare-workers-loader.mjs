export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    const source = `export const env = {
      ADMIN_PASSWORD: "admin",
    };`;
    return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent(source)}`,
    };
  }
  return nextResolve(specifier, context);
}
