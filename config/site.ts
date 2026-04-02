const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
const normalizedUrl = vercelUrl
  ? vercelUrl.startsWith("http")
    ? vercelUrl
    : `https://${vercelUrl}`
  : "http://localhost:3000";

export const siteConfig = {
  title: "iMessage Mock",
  url: normalizedUrl,
};
