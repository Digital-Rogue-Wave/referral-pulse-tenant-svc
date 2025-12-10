import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './file.entity';
import { FilesService } from './files.service';
import { FileSerializationProfile } from './serialization/file-serialization.profile';

@Module({
    imports: [TypeOrmModule.forFeature([FileEntity])],
    controllers: [FilesController],
    providers: [ConfigModule, ConfigService, FilesService, S3Client, FileSerializationProfile],
    exports: [FilesService]
})
export class FilesModule {}
