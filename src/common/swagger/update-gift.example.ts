export const UpdateGiftExample = {
    create: {
        value: {
            title: 'Example Gift Updated',
            description: 'This is an updated example reward',
            points: 100,
            limitedQuantityStatus: 'reached',
            limitOfUseQuantity: 200,
            isRequireAddress: true
        }
    }
} as const;
