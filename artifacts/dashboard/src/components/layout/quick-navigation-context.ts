const PROJECT_QUERY_ROUTES = new Set(['/tasks', '/workflows', '/events', '/metrics']);
const PROJECT_CONTEXT_TARGETS = new Set(['/tasks', '/workflows', '/events', '/metrics']);

function routePath(location: string): string {
  return location.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') || '/';
}

export function getExplicitProjectId(location: string, search: string): string | null {
  const pathname = routePath(location);
  const projectRoute = pathname.match(/^\/projects\/([^/]+)(?:\/.*)?$/);

  if (projectRoute?.[1]) {
    try {
      return decodeURIComponent(projectRoute[1]);
    } catch {
      return null;
    }
  }

  if (!PROJECT_QUERY_ROUTES.has(pathname)) return null;
  return new URLSearchParams(search).get('projectId')?.trim() || null;
}

export function isProjectScopedNavigationHref(href: string): boolean {
  return PROJECT_CONTEXT_TARGETS.has(routePath(href));
}

export function addProjectContextToHref(href: string, projectId: string | null): string {
  if (!projectId || !isProjectScopedNavigationHref(href)) return href;

  const separator = href.indexOf('?');
  const pathname = separator < 0 ? href : href.slice(0, separator);
  const search = separator < 0 ? '' : href.slice(separator + 1);
  const params = new URLSearchParams(search);
  if (!params.has('projectId')) params.set('projectId', projectId);
  return `${pathname}?${params.toString()}`;
}
