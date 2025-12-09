// swagger-examples.ts
export const UpdatePickupExample = {
    update: {
        value: {
            title: 'Updated Pickup',
            isThrowDustbin: false,
            earnPoints: 75,
            quantity: 150,
            imageMain: {
                id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                path: 'updatedImagePath'
            },
            imageConfirmation: {
                id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
                path: 'updatedConfirmationPath'
            },
            status: 'pending',
            pickupStatusColor: 'green',
            address: 'Updated Address',
            city: 'Updated City',
            longitude: -74.005941,
            latitude: 40.712776
        }
    }
} as const;
