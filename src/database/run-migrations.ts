import 'reflect-metadata';
import { AppDataSource } from './data-source';

async function main(): Promise<void> {
    await AppDataSource.initialize();
    try {
        // const pending = await AppDataSource.showMigrations();
        // runMigrations returns Migration[] on success
        await AppDataSource.runMigrations();
        await AppDataSource.destroy();
        process.exit(0);
    } catch (error) {
        console.error('[migrations] failed:', error instanceof Error ? (error.stack ?? error.message) : error);
        try {
            await AppDataSource.destroy();
        } catch {}
        process.exit(1);
    }
}

void main();
