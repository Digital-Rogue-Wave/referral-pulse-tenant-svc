import { BaseResponseMapper } from '@common/helper/base-response.mapper';

import type { FileProps } from '../files.types';
import { FileResponse } from '../responses/file.responses';

export class FileResponseMapper extends BaseResponseMapper<FileProps, FileResponse> {
    constructor() {
        super(FileResponse);
    }
}

export const fileResponseMapper = new FileResponseMapper();