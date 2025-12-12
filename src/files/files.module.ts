import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './file.entity';
import { FilesService } from './files.service';
import { FileSerializationProfile } from './serialization/file-serialization.profile';

@Module({
    imports: [TypeOrmModule.forFeature([FileEntity])],
    controllers: [FilesController],
    providers: [FilesService, FileSerializationProfile],
    exports: [FilesService]
})
export class FilesModule {}
