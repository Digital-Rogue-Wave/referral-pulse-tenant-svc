import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class KetoRelationTupleSubjectSetDto {
    @IsString()
    namespace: string;

    @IsString()
    object: string;

    @IsString()
    relation: string;
}

export class KetoRelationTupleDto {
    @IsNotEmpty()
    @IsString()
    namespace: string;

    @IsNotEmpty()
    @IsString()
    object: string;

    @IsNotEmpty()
    @IsString()
    relation: string;

    @IsString()
    @IsOptional()
    subject_id?: string;

    @IsOptional()
    @IsObject()
    subject_set?: KetoRelationTupleSubjectSetDto;
}
