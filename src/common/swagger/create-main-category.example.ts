export const CreateMainCategoryExample = {
    create: {
        value: {
            title: 'Example main Category',
            points: 100,
            description: 'This is an example create main category',
            status: 'active',
            image: {
                id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                path: 'exampleImagePath'
            },
            type: 'WASTE',
            maxQuantityAuthorized: 5,
            weight: 0
        }
    }
} as const;
