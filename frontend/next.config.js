const backend = "http://127.0.0.1:4000";

export default {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
