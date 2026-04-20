function withTrailingSlash(path: string): string {
  if (path === "/") return "/";
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.endsWith("/") ? p : `${p}/`;
}

/** More specific prefixes must appear before broader ones (e.g. `.../create/` before `.../users/`). */
const routeRules: { prefix: string; scope: string }[] = [
  { prefix: "/enterprise/balance/", scope: "enterprise:balance" },
  { prefix: "/enterprise/usage/", scope: "enterprise:usage" },
  { prefix: "/enterprise/projects/", scope: "enterprise:projects" },
  { prefix: "/enterprise/stats/", scope: "enterprise:stats" },
  { prefix: "/enterprise/users/create/", scope: "enterprise:users:write" },
  { prefix: "/enterprise/users/", scope: "enterprise:users:read" },
  { prefix: "/project/video-to-video/", scope: "project:video-to-video" },
  { prefix: "/project/text-to-video/", scope: "project:text-to-video" },
  { prefix: "/project/avatar/", scope: "project:avatar" },
  { prefix: "/text-to-video/voices/", scope: "ttv:voices" },
  { prefix: "/text-to-video/voiceover/", scope: "ttv:voiceover" },
];

/** Dynamic: /project/{uuid}/ */
const projectDetailRe = /^\/project\/[0-9a-fA-F-]{36}\/?$/;

/** Path after `/api/v1`, e.g. `/enterprise/balance/`. */
export function pathUnderApiV1(fullPathname: string): string | null {
  const prefix = "/api/v1";
  if (!fullPathname.startsWith(prefix)) return null;
  let rest = fullPathname.slice(prefix.length);
  if (rest === "") rest = "/";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  return rest;
}

/**
 * Returns required scope for this upstream-relative path, or null if unknown (deny).
 */
export function requiredScopeForPath(restPath: string): string | null {
  const p = withTrailingSlash(restPath);

  for (const { prefix, scope } of routeRules) {
    if (p.startsWith(prefix)) return scope;
  }

  const noTrail = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  if (projectDetailRe.test(noTrail)) {
    return "project:detail";
  }

  return null;
}

export function scopesAllow(required: string | null, granted: string[]): boolean {
  if (required === null) return false;
  if (granted.includes("*")) return true;
  return granted.includes(required);
}
