// Reset the DICOM Viewer login back to the factory default (admin / admin).
//
// Deletes the stored credential rows from the SQLite database; the server
// re-seeds the login from its AUTH_USERNAME / AUTH_PASSWORD environment
// variables (defaults: admin / admin) on the next sign-in attempt.
//
// Run by RESET-ADMIN.bat (DATABASE_URL points at app/db/custom.db).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const del = await db.appSetting.deleteMany({
    where: { key: { in: ["auth.username", "auth.passwordHash"] } },
  });
  console.log(`Removed ${del.count} credential row(s) from the database.`);
  console.log("The login is now: admin / admin");
} catch (e) {
  console.error("Reset failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
