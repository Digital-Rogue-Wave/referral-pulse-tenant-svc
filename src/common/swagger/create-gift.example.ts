export const CreateGiftExample = {
    create: {
        value: {
            title: 'Example Gift',
            description: 'This is an example reward',
            points: 50,
            image: {
                id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                path: 'exampleImagePath'
            },
            limitedQuantityStatus: 'not_reached',
            limitOfUseQuantity: 100,
            isRequireAddress: false
        }
    }
} as const;
