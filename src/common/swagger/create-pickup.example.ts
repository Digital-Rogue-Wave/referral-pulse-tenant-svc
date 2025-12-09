export const CreatePickupExample = {
    create: {
        value: {
            title: 'Example Pickup',
            isThrowDustbin: true,
            earnPoints: 50,
            quantity: 3,
            category: { id: 1 } // Example with the category ID
        }
    }
} as const;
