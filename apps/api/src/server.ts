import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);

buildApp()
  .then((app) => app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info(`Echoline API listening on :${port}`)))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
