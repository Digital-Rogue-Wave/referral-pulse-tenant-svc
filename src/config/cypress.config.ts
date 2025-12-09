import { registerAs } from '@nestjs/config';

export default registerAs('cypress', () => ({
    host: process.env.CYPRESS_HOST
}));
