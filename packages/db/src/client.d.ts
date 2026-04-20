import * as accessTokenSchema from './schema/access-tokens';
import * as jobSchema from './schema/jobs';
import * as pairingSchema from './schema/pairing';
import * as sessionSchema from './schema/sessions';
export type DatabaseSchema = typeof sessionSchema &
  typeof jobSchema &
  typeof pairingSchema &
  typeof accessTokenSchema;
export type DatabaseClient = ReturnType<typeof JSON.parse>;
export type DatabaseClientConfig =
  | {
      kind: 'sqlite';
      sqlitePath: string;
    }
  | {
      kind: 'postgres';
      connectionString: string;
    };
export type DatabaseConnection = {
  db: DatabaseClient;
  close: () => Promise<void>;
  kind: DatabaseClientConfig['kind'];
};
export declare function createDatabaseClient(
  config: DatabaseClientConfig,
): Promise<DatabaseConnection>;
