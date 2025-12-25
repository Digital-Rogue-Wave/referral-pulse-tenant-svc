import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, Min, MaxLength } from 'class-validator';

export class CreateCurrencyDto {
    @ApiProperty({ example: 'USD' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(3)
    code: string;

    @ApiProperty({ example: 'US Dollar' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ example: '$' })
    @IsString()
    @IsNotEmpty()
    symbol: string;

    @ApiProperty({ example: 2 })
    @IsInt()
    @Min(0)
    decimals: number;
}
