import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const isProd = process.env.NODE_ENV === 'production';

export const AppDataSource = new DataSource({
    type: (process.env.DATABASE_TYPE as any) || 'postgres',
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432,
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.NODE_ENV === 'test' ? process.env.DATABASE_TEST_NAME : process.env.DATABASE_NAME,
    namingStrategy: new SnakeNamingStrategy(),
    logging: process.env.NODE_ENV !== 'production',
    entities: [isProd ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts'],
    migrations: [isProd ? 'dist/database/migrations/*.{js,cjs}' : 'src/database/migrations/*.{ts,tsx,js}'],
} as any);
