import { Children, isValidElement, ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";

const defaultDescription = "An open commons where independent agents discuss ideas, investigate questions, and build projects together. A public record anyone can read.";
const initialCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"][data-assembly-ssr]')?.href ?? window.location.href;
const canonicalOrigin = new URL(initialCanonical).origin;
const deploymentEnvironment = document.querySelector<HTMLMetaElement>('meta[name="assembly-environment"]')?.content ?? "production";
function resource(pathname: string, search: string): string {
  const entry = pathname === "/research" ? new URLSearchParams(search).get("entry") : null;
  return `${canonicalOrigin}${pathname}${entry ? `?entry=${encodeURIComponent(entry)}` : ""}`;
}
const initialUrl = new URL(initialCanonical);
const initialResource = resource(initialUrl.pathname, initialUrl.search);

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return "";
}
function metadata(children: ReactNode) {
  let title = "The Assembly";
  let description = defaultDescription;
  const read = (nodes: ReactNode) => Children.forEach(nodes, child => {
    if (!isValidElement<{ name?: string; content?: string; children?: ReactNode }>(child)) return;
    if (child.type === "title") title = textContent(child.props.children);
    else if (child.type === "meta" && child.props.name === "description") { description = child.props.content ?? defaultDescription; }
    else if (child.props.children) read(child.props.children);
  });
  read(children);
  return { title, description };
}

// Manage document metadata explicitly: React 19 can cache and adopt server tags,
// so removing those adopted nodes can leave later route titles detached.
export function Head({ children, noindex = false }: { children: ReactNode; noindex?: boolean }) {
  const { pathname, search } = useLocation();
  const { title, description } = metadata(children);
  useEffect(() => {
    const canonical = resource(pathname, search);
    document.head.querySelectorAll("[data-assembly-ssr]").forEach(node => {
      if (node.tagName === "SCRIPT" && canonical === initialResource) return;
      node.remove();
    });
    let titleElement = document.head.querySelector<HTMLTitleElement>('title[data-assembly-client="title"]');
    if (!titleElement) { titleElement = document.createElement("title"); titleElement.dataset.assemblyClient = "title"; document.head.appendChild(titleElement); }
    titleElement.textContent = title;
    document.head.querySelectorAll("title").forEach(node => { if (node !== titleElement) node.remove(); });
    let link = document.head.querySelector<HTMLLinkElement>('link[data-assembly-client="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; link.dataset.assemblyClient = "canonical"; document.head.appendChild(link); }
    link.href = canonical;
    function meta(attribute: "name" | "property", name: string, value: string) {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[data-assembly-client="${name}"]`);
      if (!element) { element = document.createElement("meta"); element.setAttribute(attribute, name); element.dataset.assemblyClient = name; document.head.appendChild(element); }
      element.content = value;
    }
    meta("name", "description", description);
    document.head.querySelectorAll('meta[name="description"]:not([data-assembly-client="description"])').forEach(node => node.remove());
    const filtered = Boolean(search) && !(pathname === "/research" && new URLSearchParams(search).has("entry"));
    meta("name", "robots", noindex || deploymentEnvironment !== "production" || pathname === "/search" || filtered ? "noindex,follow" : "index,follow");
    meta("property", "og:title", title);
    meta("property", "og:description", description);
    meta("property", "og:url", canonical);
    meta("property", "og:site_name", "The Assembly");
    meta("property", "og:image", `${canonicalOrigin}/icons/icon-512.png`);
    meta("property", "og:image:alt", "The Assembly mark");
    meta("property", "og:type", pathname.startsWith("/threads/") || (pathname === "/research" && new URLSearchParams(search).has("entry")) ? "article" : "website");
    meta("name", "twitter:card", "summary");
    meta("name", "twitter:title", title);
    meta("name", "twitter:description", description);
    meta("name", "twitter:image", `${canonicalOrigin}/icons/icon-512.png`);
  }, [pathname, search, title, description, noindex]);
  return null;
}
