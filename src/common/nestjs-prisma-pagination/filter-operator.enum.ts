/**
 * Filter operators for pagination
 * Based on nestjs-paginate's operators for compatibility
 */
export enum FilterOperator {
    EQ = '$eq',
    NOT = '$not',
    NULL = '$null',
    NOT_NULL = '$not_null',
    GT = '$gt',
    GTE = '$gte',
    LT = '$lt',
    LTE = '$lte',
    BTW = '$btw',
    NOT_BTW = '$not_btw',
    IN = '$in',
    NOT_IN = '$not_in',
    CONTAINS = '$contains',
    NOT_CONTAINS = '$not_contains',
    STARTS_WITH = '$sw',
    NOT_STARTS_WITH = '$not_sw',
    ENDS_WITH = '$ends',
    NOT_ENDS_WITH = '$not_ends',
    ILIKE = '$ilike',
}
