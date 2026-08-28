import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` нужен только локальной разработке (см. lib/db/index.ts), но собирать
  // его в серверный бандл незачем — пакет остаётся внешним и грузится с диска.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
