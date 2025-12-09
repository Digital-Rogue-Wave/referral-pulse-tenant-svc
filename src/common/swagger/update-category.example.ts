export const UpdateCategoryExample = {
    update: {
        value: {
            title: 'Example update Category',
            points: 100,
            description: 'This is an example update sub category',
            status: 'active',
            image: {
                id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                path: 'exampleImagePath'
            },
            type: 'BULK',
            maxQuantityAuthorized: 5,
            weight: 0,
            parent: { id: 1 }
        }
    }
} as const;
